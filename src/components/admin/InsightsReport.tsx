import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { ArrowDownUp, ChartNoAxesCombined, Filter, Package } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { Skeleton } from '../ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { AdminDateRangeFilter, type AdminDateSelection } from './AdminDateRangeFilter';
import { FilterBar, FilterField, FilterSelect, SearchInput } from './filter-bar';
import { INSIGHTS_CHANNEL_OPTIONS, UTM_NONE_LABEL, insightsDateSelection, insightsInitialQuery, insightsMoney as money, insightsNumber as number, insightsOrderLink, insightsPercent as percent, sortInsightRows, withInsightsPeriod, type InsightsReport as Report } from '../../lib/insights-view';
import { INSIGHTS_MAX_RANGE_DAYS } from '../../lib/insights-period';
import { SOURCE_SLUG_NONE_FILTER, SOURCE_SLUG_NONE_LABEL } from '../../lib/source-slug';
import type { landingRanking, trendSeries, productRanking, locationRanking, orderTimes, utmReport } from '../../lib/insights';

type Landing = Awaited<ReturnType<typeof landingRanking>>['data'];
type Trend = Awaited<ReturnType<typeof trendSeries>>['data'];
type Products = Awaited<ReturnType<typeof productRanking>>['data'];
type Locations = Awaited<ReturnType<typeof locationRanking>>['data'];
type Times = Awaited<ReturnType<typeof orderTimes>>['data'];
type Utm = Awaited<ReturnType<typeof utmReport>>['data'];
type ReportData = Landing | Trend | Products | Locations | Times | Utm;
type Choice = { value: string; label: string };
const Chart = lazy(() => import('./InsightsChart').catch(() => ({
  default: function ChartUnavailable() {
    return <div role="alert" className="flex h-64 flex-col items-start justify-center gap-3 text-sm">
      <p>Grafik belum dapat dimuat. Data harian tetap tersedia di bawah.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>Muat ulang grafik</Button>
    </div>;
  },
})));
const sectionClass = 'rounded-lg border border-border bg-card p-4 text-card-foreground';
const metricLabels = { orders: 'Pesanan', leads: 'Lead', revenue: 'Omset' };

function Loading() { return <div aria-busy="true" aria-label="Memuat laporan" className="flex flex-col gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>; }
/** RTS above this share is flagged for review on every Analitik screen. */
const RTS_REVIEW_SHARE = 20;
/** RTS as a figure: red with a dot above the review line, the reason on hover and for screen readers. */
function ReturnShare({ value }: { value: number }) {
  const flagged = value > RTS_REVIEW_SHARE;
  return <span className={cn('inline-flex items-center justify-end gap-1.5 tabular-nums', flagged && 'font-medium text-destructive')} title={flagged ? 'Perlu perhatian: retur di atas 20%' : undefined}>
    {flagged && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}{percent(value)}{flagged && <span className="sr-only"> · Perlu perhatian</span>}
  </span>;
}
function Empty({ reset }: { reset: () => void }) { return <div className={sectionClass}><h3 className="text-base font-semibold">Belum ada data pada pilihan ini</h3><p className="my-3 text-sm text-muted-foreground">Coba periode atau filter lain. Data akan muncul setelah toko menerima lead atau pesanan.</p><Button variant="outline" onClick={reset}>Reset filter</Button></div>; }

export function InsightsReport({ report, initialQuery = '', sources = [], products = [], mayReadOrders = false, initialData }: {
  report: Report; initialQuery?: string; sources?: Choice[]; products?: Choice[]; mayReadOrders?: boolean; initialData?: ReportData;
}) {
  const [query, setQuery] = useState(() => insightsInitialQuery(initialQuery));
  const [date, setDate] = useState<AdminDateSelection>(() => insightsDateSelection(insightsInitialQuery(initialQuery)));
  const initial = new URLSearchParams(initialQuery);
  const [channel, setChannel] = useState(initial.get('channel') || '');
  const [source, setSource] = useState(initial.get('source') || '');
  const [product, setProduct] = useState(initial.get('product_id') || '');
  const [data, setData] = useState<ReportData | undefined>(initialData);
  const [busy, setBusy] = useState(!initialData);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(0);
  const [retry, setRetry] = useState(0);
  const [metric, setMetric] = useState<'orders' | 'leads' | 'revenue'>('revenue');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [channel, source, product].filter(Boolean).length;

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(''); setStatus(0);
    fetch(`/api/admin/insights/${report}?${query}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) { setStatus(response.status); throw new Error(body.error || 'Laporan tidak dapat dimuat.'); }
        if (!controller.signal.aborted) setData(body.data);
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Laporan tidak dapat dimuat.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [report, query, retry]);

  // Rewrite only this report family's links, including the existing sidebar.
  // Delegated, so the period reaches links rendered by the separately hydrated
  // AdminShell. Rewritten before any activation reads the href: pointerdown
  // precedes a click, middle-click and the context menu; focusin precedes Enter.
  useEffect(() => {
    const carry = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.origin !== window.location.origin) return;
      const next = withInsightsPeriod(anchor.pathname, window.location.pathname, query);
      if (next !== anchor.pathname) anchor.href = next;
    };
    const events = ['pointerdown', 'focusin', 'click'] as const;
    for (const type of events) document.addEventListener(type, carry, true);
    return () => { for (const type of events) document.removeEventListener(type, carry, true); };
  }, [query]);

  function changeQuery(params: URLSearchParams) {
    const next = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}?${next}`);
    setQuery(next);
  }
  function apply() {
    const params = new URLSearchParams();
    params.set('date_filter', date.filter);
    if (date.filter === 'custom') { params.set('date_start', date.start); params.set('date_end', date.end); }
    if (report !== 'landing' && channel) params.set('channel', channel);
    if (source) params.set('source', source); else if (product) params.set('product_id', product);
    changeQuery(params);
  }
  function reset() {
    setDate(insightsDateSelection('date_filter=this_month')); setSource(''); setProduct(''); setChannel('');
    changeQuery(new URLSearchParams('date_filter=this_month'));
  }
  // Province, then city: `city` only ever narrows the province beside it, so
  // changing the province drops it. An empty city key is a real place.
  function place(province: string, city: string | null = null) {
    const params = new URLSearchParams(query);
    if (province) params.set('province', province); else params.delete('province');
    if (province && city !== null) params.set('city', city); else params.delete('city');
    changeQuery(params);
  }
  const appliedDate = insightsDateSelection(query);
  const sourceOptions = [{ value: '', label: 'Semua halaman' }, { value: SOURCE_SLUG_NONE_FILTER, label: SOURCE_SLUG_NONE_LABEL }, ...sources];
  if (source && !sourceOptions.some((item) => item.value === source)) sourceOptions.push({ value: source, label: source });
  const productOptions = [{ value: '', label: 'Semua produk' }, ...products];
  if (product && !productOptions.some((item) => item.value === product)) productOptions.push({ value: product, label: `Produk #${product}` });

  return <div className="flex min-w-0 flex-col gap-5" data-insights-report={report}>
    <div className={sectionClass}>
      <FilterBar>
        <FilterField label="Periode · WIB" size="lg"><AdminDateRangeFilter value={date} onChange={setDate} maxCustomRangeDays={INSIGHTS_MAX_RANGE_DAYS} hiddenPresets={['all', '180d']} /></FilterField>
        {/* Phones: the period stays, the rest folds behind "Filter" so the
            report starts on the first screen; `contents` keeps them flex items. */}
        {report !== 'landing' && <Button type="button" variant="outline" className="md:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          <Filter aria-hidden="true" />Filter{activeFilters ? ` (${activeFilters})` : ''}
        </Button>}
        <div className={cn('contents', !filtersOpen && 'max-md:hidden')}>
        {report !== 'landing' && <FilterField label="Kanal" htmlFor="insights-channel"><FilterSelect id="insights-channel" icon={Filter} value={channel} options={INSIGHTS_CHANNEL_OPTIONS} onValueChange={setChannel} /></FilterField>}
        {report === 'trend' && <>
          <FilterField label="Halaman" htmlFor="insights-source"><FilterSelect id="insights-source" icon={ChartNoAxesCombined} value={source} options={sourceOptions} onValueChange={(value) => { setSource(value); setProduct(''); }} /></FilterField>
          <FilterField label="Produk" htmlFor="insights-product"><FilterSelect id="insights-product" icon={Package} value={product} options={productOptions} onValueChange={(value) => { setProduct(value); setSource(''); }} /></FilterField>
          <FilterField label="Slug historis (opsional)" htmlFor="insights-slug" size="lg"><SearchInput id="insights-slug" value={source === SOURCE_SLUG_NONE_FILTER ? '' : source} onValueChange={(value) => { setSource(value.trim()); setProduct(''); }} placeholder="Contoh: promo-kopi" /></FilterField>
        </>}
        </div>
        <Button onClick={apply} disabled={busy}>Terapkan</Button><Button variant="outline" onClick={reset}>Reset</Button>
      </FilterBar>
    </div>
    {report !== 'trend' && (source || product) && <p className="flex flex-wrap items-center gap-2 text-sm">
      Filter aktif: {source ? `Halaman ${sourceOptions.find((item) => item.value === source)?.label ?? source}` : `Produk ${productOptions.find((item) => item.value === product)?.label ?? product}`}
      <Button variant="outline" onClick={() => { setSource(''); setProduct(''); const params = new URLSearchParams(query); params.delete('source'); params.delete('product_id'); changeQuery(params); }}>Hapus filter</Button>
    </p>}
    <p className="text-xs text-muted-foreground" aria-live="polite">
      <span className="font-medium text-foreground">{appliedDate.start || '—'} – {appliedDate.end || '—'}</span> · Asia/Jakarta (WIB) · dari data pesanan, bukan kunjungan; sumber pesanan lama bisa tidak tercatat.
    </p>
    {busy ? <Loading /> : error ? <div role="alert" className={sectionClass}>
      <h3 className="text-base font-semibold">{status === 403 ? 'Akses laporan ditolak' : status === 401 ? 'Sesi berakhir' : 'Laporan belum dapat dimuat'}</h3>
      <p className="my-3 text-sm">{error}</p>
      {status === 401 ? <a href="/hello" className="underline">Masuk kembali</a> : <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Coba lagi</Button>}
    </div> : data && <>
      {report === 'landing' && ((data as Landing).rows.length ? <LandingView data={data as Landing} query={query} mayReadOrders={mayReadOrders} /> : <Empty reset={reset} />)}
      {report === 'products' && ((data as Products).rows.length ? <ProductsView data={data as Products} /> : <Empty reset={reset} />)}
      {report === 'trend' && <TrendView data={data as Trend} metric={metric} setMetric={setMetric} />}
      {report === 'locations' && ((data as Locations).provinces.length || (data as Locations).incomplete_address.orders ? <LocationsView data={data as Locations} onPlace={place} /> : <Empty reset={reset} />)}
      {report === 'times' && ((data as Times).total ? <TimesView data={data as Times} /> : <Empty reset={reset} />)}
      {report === 'utm' && ((data as Utm).rows.length ? <UtmView data={data as Utm} /> : <Empty reset={reset} />)}
    </>}
  </div>;
}

// ── Shared table anatomy ────────────────────────────────────────────────────
// Every Analitik table: one bordered shell that scrolls sideways, upper-case
// headers, numbers right-aligned in tabular figures, the first column pinned
// so the row's name stays readable while the numbers scroll. Under `md` the
// same rows become a compact list: name and the headline number on one line,
// the other figures as one line of small text.

const tableShell = 'hidden overflow-x-auto rounded-lg border border-border bg-card md:block [&>div]:overflow-visible';
const headCell = 'px-3 text-xs uppercase tracking-wide text-muted-foreground';
// The pinned column needs an opaque fill: slate-50 is admin.css's thead and
// row-hover colour, so the pinned cell matches its row in both states.
const nameHead = cn(headCell, 'sticky left-0 z-[1] bg-slate-50');
const numHead = cn(headCell, 'text-right');
const numCell = 'px-3 text-right tabular-nums';
const pinned = 'sticky left-0 z-[1] bg-card [tr:hover>&]:bg-slate-50';
const nameCell = cn(pinned, 'min-w-48 max-w-80 whitespace-normal px-3');
const listShell = 'divide-y divide-border rounded-lg border border-border bg-card md:hidden';

function ReportTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className={tableShell} tabIndex={0} role="region" aria-label={`${label}, geser untuk melihat semua kolom`}><Table>{children}</Table></div>;
}

/** One row of a report as a compact phone list item. */
function ListRow({ title, detail, value, stats }: { title: ReactNode; detail?: ReactNode; value: ReactNode; stats: Array<[string, ReactNode]> }) {
  return <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0"><div className="break-words text-sm font-medium">{title}</div>{detail && <div className="break-words text-xs text-muted-foreground">{detail}</div>}</div>
      <div className="shrink-0 text-sm font-semibold tabular-nums">{value}</div>
    </div>
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">{stats.map(([label, stat]) => <div key={label} className="flex gap-1"><dt>{label}</dt><dd className="tabular-nums text-foreground">{stat}</dd></div>)}</dl>
  </div>;
}

/**
 * A drill-down name: a link-styled button that wraps instead of overrunning
 * its column. Its text sits at the top: on a phone admin.css gives every
 * button a 2.75rem touch floor, and centred text then drops below the figure
 * beside it.
 */
function DrillName({ label, onOpen }: { label: string; onOpen: () => void }) {
  return <Button variant="link" className="h-auto items-start justify-start p-0 text-left whitespace-normal" onClick={onOpen}>{label}</Button>;
}

const landingColumns = [
  ['leads', 'Lead'], ['orders', 'Pesanan'], ['revenue', 'Omset'], ['delivered_revenue', 'Omset terkirim'],
  ['average_order_value', 'Rata-rata'], ['closing_rate', 'Closing'], ['delivered_share', 'Terkirim'], ['return_share', 'RTS'],
] as const;
type LandingRow = Landing['rows'][number];
type LandingSort = 'label' | typeof landingColumns[number][0];
function landingValue(row: LandingRow, key: typeof landingColumns[number][0]) {
  if (key === 'return_share') return <ReturnShare value={row.return_share} />;
  if (key === 'closing_rate' || key === 'delivered_share') return percent(row[key]);
  if (key === 'leads' || key === 'orders') return number(row[key]);
  return money(row[key]);
}
/** The orders' ad channels as one short line: only the channels that sent any. */
function channelSummary(row: LandingRow) {
  const parts = INSIGHTS_CHANNEL_OPTIONS.filter((item) => item.value && row.channels[item.value as keyof typeof row.channels])
    .map((item) => `${item.label} ${number(row.channels[item.value as keyof typeof row.channels])}`);
  return parts.join(' · ') || '—';
}
const followUpTitle = (row: LandingRow) =>
  `Belum dihubungi ${row.follow_up.new} · Sudah dihubungi ${row.follow_up.contacted} · Potensial ${row.follow_up.qualified} · Konversi ${row.follow_up.converted} · Tidak tertarik ${row.follow_up.not_interested}`;
function LandingView({ data, query, mayReadOrders }: { data: Landing; query: string; mayReadOrders: boolean }) {
  const [sort, setSort] = useState<LandingSort>('delivered_revenue');
  const [descending, setDescending] = useState(true);
  const rows = sortInsightRows(data.rows, sort, descending);
  const name = (row: LandingRow) => mayReadOrders ? <a className="underline underline-offset-4" href={insightsOrderLink(row.slug, query)}>{row.label}</a> : row.label;
  const sortBy = (key: LandingSort) => { setSort(key); setDescending(sort === key ? !descending : key !== 'label'); };
  const sortHead = (key: LandingSort, label: string, numeric = true) => <TableHead key={key} className={numeric ? numHead : nameHead} aria-sort={sort === key ? descending ? 'descending' : 'ascending' : 'none'}>
    <Button variant="ghost" size="xs" className="-mx-2 uppercase tracking-wide text-muted-foreground" onClick={() => sortBy(key)}>{label}{sort === key && <span aria-hidden="true">{descending ? '↓' : '↑'}</span>}</Button>
  </TableHead>;
  return <section className="flex min-w-0 flex-col gap-3">
    <p className="text-xs text-muted-foreground">Omset = nilai pesanan aktif, belum tentu dibayar. Closing = pesanan / (pesanan + lead). RTS merah = retur di atas 20%. Urutkan dengan mengetuk judul kolom.</p>
    <FilterBar className="md:hidden"><FilterField label="Urutkan" htmlFor="landing-sort" size="lg"><FilterSelect id="landing-sort" icon={ArrowDownUp} value={sort} options={[{ value: 'label' as LandingSort, label: 'Nama halaman' }, ...landingColumns.map(([value, label]) => ({ value: value as LandingSort, label }))]} onValueChange={(key) => { setSort(key); setDescending(key !== 'label'); }} /></FilterField><Button variant="outline" onClick={() => setDescending(!descending)}>{descending ? 'Terbesar dulu' : 'Terkecil dulu'}</Button></FilterBar>
    <ReportTable label="Peringkat landing page">
      <TableHeader><TableRow>{sortHead('label', 'Halaman', false)}{landingColumns.map(([key, label]) => sortHead(key, label))}<TableHead className={headCell}>Kanal pesanan</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.slug ?? SOURCE_SLUG_NONE_FILTER}>
        <TableCell className={nameCell}>{name(row)}</TableCell>
        {landingColumns.map(([key]) => <TableCell key={key} className={numCell} title={key === 'leads' ? followUpTitle(row) : undefined}>{landingValue(row, key)}</TableCell>)}
        <TableCell className="min-w-40 whitespace-normal px-3 text-xs text-muted-foreground">{channelSummary(row)}</TableCell>
      </TableRow>)}</TableBody>
    </ReportTable>
    <div className={listShell}>{rows.map((row) => <ListRow key={row.slug ?? SOURCE_SLUG_NONE_FILTER} title={name(row)} detail={channelSummary(row)} value={money(row.delivered_revenue)}
      stats={[['Pesanan', number(row.orders)], ['Lead', number(row.leads)], ['Omset', money(row.revenue)], ['Closing', percent(row.closing_rate)], ['RTS', <ReturnShare value={row.return_share} />]]} />)}</div>
  </section>;
}

function ProductVariants({ row }: { row: Products['rows'][number] }) {
  if (row.variants.length === 1) return <span className="text-xs text-muted-foreground">{row.variants[0].label}</span>;
  return <details className="min-w-0 text-xs"><summary className="cursor-pointer text-muted-foreground">{row.variants.length} varian</summary>
    <ul className="mt-1 flex flex-col gap-0.5">{row.variants.map((variant, index) => <li key={variant.variant_id ?? index} className="flex justify-between gap-3"><span className="min-w-0 break-words">{variant.label}</span><span className="shrink-0 tabular-nums">{number(variant.units)} · {money(variant.revenue)}</span></li>)}</ul>
  </details>;
}
function ProductsView({ data }: { data: Products }) {
  return <section className="flex min-w-0 flex-col gap-3">
    <p className="text-sm">{number(data.totals.units)} unit aktif · {money(data.totals.revenue)} omset produk (tanpa ongkir)</p>
    <p className="text-xs text-muted-foreground">RTS dihitung per unit: retur / (terkirim + retur). Merah = di atas 20%.</p>
    <ReportTable label="Peringkat produk">
      <TableHeader><TableRow><TableHead className={nameHead}>Produk</TableHead><TableHead className={numHead}>Unit aktif</TableHead><TableHead className={numHead}>Omset produk</TableHead><TableHead className={numHead}>Terkirim</TableHead><TableHead className={numHead}>Retur</TableHead><TableHead className={numHead}>RTS</TableHead><TableHead className={cn(headCell, 'min-w-48')}>Varian</TableHead></TableRow></TableHeader>
      <TableBody>{data.rows.map((row) => <TableRow key={row.product_id ?? 'deleted'} className="align-top">
        <TableCell className={cn(nameCell, 'font-medium')}>{row.label}</TableCell>
        <TableCell className={numCell}>{number(row.units)}</TableCell>
        <TableCell className={numCell}>{money(row.revenue)}</TableCell>
        <TableCell className={numCell}>{number(row.delivered_units ?? 0)}</TableCell>
        <TableCell className={numCell}>{number(row.returned_units ?? 0)}</TableCell>
        <TableCell className={numCell}><ReturnShare value={row.return_share} /></TableCell>
        <TableCell className="min-w-48 whitespace-normal px-3"><ProductVariants row={row} /></TableCell>
      </TableRow>)}</TableBody>
    </ReportTable>
    <div className={listShell}>{data.rows.map((row) => <ListRow key={row.product_id ?? 'deleted'} title={row.label} detail={<ProductVariants row={row} />} value={money(row.revenue)}
      stats={[['Unit', number(row.units)], ['Terkirim', number(row.delivered_units ?? 0)], ['Retur', number(row.returned_units ?? 0)], ['RTS', <ReturnShare value={row.return_share} />]]} />)}</div>
  </section>;
}
function TrendView({ data, metric, setMetric }: { data: Trend; metric: 'orders' | 'leads' | 'revenue'; setMetric: (value: 'orders' | 'leads' | 'revenue') => void }) {
  const format = metric === 'revenue' ? money : number;
  return <section className={sectionClass}>
    <FilterBar><FilterField label="Metrik" htmlFor="trend-metric"><FilterSelect id="trend-metric" icon={ChartNoAxesCombined} value={metric} options={Object.entries(metricLabels).map(([value, label]) => ({ value: value as typeof metric, label }))} onValueChange={setMetric} /></FilterField></FilterBar>
    <div className="my-4 grid grid-cols-2 gap-4"><div><p className="text-xs text-muted-foreground">Periode terpilih</p><p className="whitespace-nowrap text-xl font-semibold tabular-nums sm:text-2xl">{format(data.total[metric])}</p></div><div><p className="text-xs text-muted-foreground">Sebelumnya · {data.previous.start} – {data.previous.end}</p><p className="whitespace-nowrap text-xl font-semibold tabular-nums sm:text-2xl">{format(data.previous[metric])}</p></div></div>
    {data.total.orders + data.total.leads === 0 && <p className="mb-3 text-sm">Tidak ada pesanan atau lead pada periode ini.</p>}
    <figure><Suspense fallback={<Skeleton className="h-64 w-full" />}><Chart series={data.series} metric={metric} /></Suspense><figcaption className="mt-2 text-xs text-muted-foreground">{metricLabels[metric]} per hari · WIB. Hari tanpa data ditampilkan nol. Omset bukan konfirmasi pembayaran.</figcaption></figure>
    <details className="mt-4"><summary className="cursor-pointer py-2 text-sm">Lihat data harian</summary><Table><TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Pesanan</TableHead><TableHead>Lead</TableHead><TableHead>Omset</TableHead></TableRow></TableHeader><TableBody>{data.series.map((day) => <TableRow key={day.date}><TableCell>{day.date}</TableCell><TableCell>{number(day.orders)}</TableCell><TableCell>{number(day.leads)}</TableCell><TableCell>{money(day.revenue)}</TableCell></TableRow>)}</TableBody></Table></details>
  </section>;
}
function LocationsView({ data, onPlace }: { data: Locations; onPlace: (province: string, city?: string | null) => void }) {
  const province = data.province;
  const city = province?.city ?? null;
  const places = city ? city.districts : province ? province.cities : data.provinces;
  const level = city ? 'Kecamatan' : province ? 'Kota / kabupaten' : 'Provinsi';
  const open = (key: string) => (province ? onPlace(province.key, key) : onPlace(key));
  // Districts are the last level; "Lainnya" sums the places past the top rows.
  const name = (place: (typeof places)[number]) => !city && place.key !== 'other' ? <DrillName label={place.label} onOpen={() => open(place.key)} /> : place.label;
  const incomplete = !province && data.incomplete_address.orders > 0 ? data.incomplete_address : null;
  const incompleteNote = 'Kecamatan belum diisi (mis. middle form sebelum dilengkapi operator). Provinsinya hanya tebakan IP, jadi belum dihitung per wilayah.';
  return <section className="flex min-w-0 flex-col gap-3">
    <nav aria-label="Tingkat wilayah" className="min-w-0"><ol className="flex flex-wrap items-center gap-1 text-base font-semibold">
      <li>{province ? <Button variant="link" className="h-auto p-0" onClick={() => onPlace('')}>Provinsi</Button> : <span aria-current="page">Provinsi</span>}</li>
      {province && <li className="flex min-w-0 items-center gap-1"><span aria-hidden="true">›</span>{city ? <Button variant="link" className="h-auto p-0 text-left whitespace-normal" onClick={() => onPlace(province.key)}>{province.label}</Button> : <span aria-current="page" className="break-words">{province.label}</span>}</li>}
      {city && <li className="flex min-w-0 items-center gap-1"><span aria-hidden="true">›</span><span aria-current="page" className="break-words">{city.label}</span></li>}
    </ol></nav>
    <p className="text-xs text-muted-foreground">{city ? 'Tingkat terakhir.' : 'Ketuk nama wilayah untuk melihat isinya.'} RTS = retur / (terkirim + retur); merah = di atas 20%. Lainnya menjumlahkan wilayah di luar peringkat teratas.</p>
    {places.length === 0 && <p className="text-sm">{city ? 'Tidak ada kecamatan pada kota ini' : 'Tidak ada kota pada provinsi ini'} untuk filter terpilih.</p>}
    {(places.length > 0 || incomplete) && <>
      <ReportTable label={`Pesanan per ${level.toLowerCase()}`}>
        <TableHeader><TableRow><TableHead className={nameHead}>{level}</TableHead><TableHead className={numHead}>Pesanan</TableHead><TableHead className={numHead}>Omset</TableHead><TableHead className={numHead}>Terkirim</TableHead><TableHead className={numHead}>Retur</TableHead><TableHead className={numHead}>RTS</TableHead></TableRow></TableHeader>
        <TableBody>
          {places.map((place) => <TableRow key={place.key}><TableCell className={nameCell}>{name(place)}</TableCell><TableCell className={numCell}>{number(place.orders)}</TableCell><TableCell className={numCell}>{money(place.revenue)}</TableCell><TableCell className={numCell}>{number(place.delivered ?? 0)}</TableCell><TableCell className={numCell}>{number(place.returned ?? 0)}</TableCell><TableCell className={numCell}><ReturnShare value={place.return_share} /></TableCell></TableRow>)}
          {incomplete && <TableRow className="text-muted-foreground"><TableCell className={nameCell}><span className="cursor-help underline decoration-dotted underline-offset-4" title={incompleteNote}>Alamat belum dilengkapi</span></TableCell><TableCell className={numCell}>{number(incomplete.orders)}</TableCell><TableCell className={numCell}>{money(incomplete.revenue)}</TableCell><TableCell className={numCell}>{number(incomplete.delivered)}</TableCell><TableCell className={numCell}>{number(incomplete.returned)}</TableCell><TableCell className={numCell}><ReturnShare value={incomplete.return_share} /></TableCell></TableRow>}
        </TableBody>
      </ReportTable>
      <div className={listShell}>
        {places.map((place) => <ListRow key={place.key} title={name(place)} value={money(place.revenue)} stats={[['Pesanan', number(place.orders)], ['Terkirim', number(place.delivered ?? 0)], ['Retur', number(place.returned ?? 0)], ['RTS', <ReturnShare value={place.return_share} />]]} />)}
        {incomplete && <ListRow title={<span className="text-muted-foreground">Alamat belum dilengkapi</span>} detail={incompleteNote} value={money(incomplete.revenue)} stats={[['Pesanan', number(incomplete.orders)], ['RTS', <ReturnShare value={incomplete.return_share} />]]} />}
      </div>
    </>}
    {data.unmatched_provinces.length > 0 && <p className="text-xs text-muted-foreground">Nama belum cocok dengan katalog: {data.unmatched_provinces.join(', ')}. Tidak digabung otomatis.</p>}
  </section>;
}

const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
function TimesView({ data }: { data: Times }) {
  const hourTotals = Array.from({ length: 24 }, (_, hour) => data.cells.reduce((sum, day) => sum + (day[hour] || 0), 0));
  const dayTotals = data.cells.map((day) => day.reduce((sum, value) => sum + (value || 0), 0));
  const busiest = hourTotals.indexOf(Math.max(...hourTotals));
  const cellCls = 'px-2 py-1 text-center tabular-nums';
  return <section className="flex min-w-0 flex-col gap-3">
    <p className="text-sm">{number(data.total)} pesanan · jam tersibuk {String(busiest).padStart(2, '0')}:00 WIB ({number(hourTotals[busiest] || 0)} pesanan)</p>
    <p className="text-xs text-muted-foreground">Angka = jumlah pesanan per jam dan hari (WIB); warna makin pekat = makin banyak (maks {number(data.max)}). – = tidak ada pesanan.</p>
    <div className="overflow-x-auto rounded-lg border border-border bg-card [&>div]:overflow-visible" tabIndex={0} role="region" aria-label="Tabel waktu beli, geser untuk melihat semua hari"><Table>
      <TableHeader><TableRow><TableHead className={nameHead}>Jam</TableHead>{WEEKDAYS.map((day) => <TableHead key={day} className={cn(headCell, 'text-center')}>{day}</TableHead>)}<TableHead className={numHead}>Total</TableHead></TableRow></TableHeader>
      <TableBody>
        {hourTotals.map((total, hour) => <TableRow key={hour}>
          <TableCell className={cn(pinned, "px-3 py-1 tabular-nums text-muted-foreground")}>{String(hour).padStart(2, '0')}:00</TableCell>
          {WEEKDAYS.map((day, weekday) => {
            const value = data.cells[weekday][hour] || 0;
            return <TableCell key={day} className={cn(cellCls, !value && 'text-muted-foreground')} style={{ backgroundColor: value ? `color-mix(in srgb, var(--chart-1) ${10 + Math.round(value / Math.max(1, data.max) * 22)}%, transparent)` : undefined }}>{value ? number(value) : '–'}</TableCell>;
          })}
          <TableCell className={cn(numCell, 'py-1 font-medium', !total && 'text-muted-foreground')}>{total ? number(total) : '–'}</TableCell>
        </TableRow>)}
        <TableRow className="border-t border-border"><TableCell className={cn(pinned, "px-3 py-1 font-medium")}>Total</TableCell>{dayTotals.map((total, weekday) => <TableCell key={WEEKDAYS[weekday]} className={cn(cellCls, 'font-medium', !total && 'text-muted-foreground')}>{total ? number(total) : '–'}</TableCell>)}<TableCell className={cn(numCell, 'py-1 font-semibold')}>{number(data.total)}</TableCell></TableRow>
      </TableBody>
    </Table></div>
  </section>;
}

const utmColumns = [
  ['leads', 'Lead'], ['orders', 'Pesanan'], ['revenue', 'Omset'], ['delivered_revenue', 'Omset terkirim'],
  ['closing_rate', 'Closing'], ['delivered', 'Terkirim'], ['returned', 'Retur'], ['return_share', 'RTS'],
] as const;
type UtmRow = Utm['rows'][number];
type UtmMetrics = Pick<UtmRow, typeof utmColumns[number][0]>;
function utmValue(row: UtmMetrics, key: typeof utmColumns[number][0]) {
  if (key === 'revenue' || key === 'delivered_revenue') return money(row[key]);
  if (key === 'return_share') return <ReturnShare value={row.return_share} />;
  if (key === 'closing_rate') return percent(row.closing_rate);
  return number(row[key]);
}
const utmCampaign = (row: UtmRow) => (row.untagged ? UTM_NONE_LABEL : row.campaign ?? '(tanpa campaign)');
const utmOrigin = (row: UtmRow) => (row.untagged ? 'Pesanan tanpa tag source, medium, atau campaign' : `${row.source ?? '—'} / ${row.medium ?? '—'}`);
function UtmTable({ label, rows }: { label: string; rows: Array<{ key: string; name: ReactNode; detail?: string; metrics: UtmMetrics }> }) {
  return <>
    <ReportTable label={label}>
      <TableHeader><TableRow><TableHead className={nameHead}>{label}</TableHead>{utmColumns.map(([key, title]) => <TableHead key={key} className={numHead}>{title}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.key}><TableCell className={nameCell}><div className="break-words font-medium">{row.name}</div>{row.detail && <div className="text-xs text-muted-foreground">{row.detail}</div>}</TableCell>{utmColumns.map(([key]) => <TableCell key={key} className={numCell}>{utmValue(row.metrics, key)}</TableCell>)}</TableRow>)}</TableBody>
    </ReportTable>
    <div className={listShell}>{rows.map((row) => <ListRow key={row.key} title={row.name} detail={row.detail} value={money(row.metrics.delivered_revenue)}
      stats={[['Pesanan', number(row.metrics.orders)], ['Lead', number(row.metrics.leads)], ['Omset', money(row.metrics.revenue)], ['Closing', percent(row.metrics.closing_rate)], ['RTS', <ReturnShare value={row.metrics.return_share} />]]} />)}</div>
  </>;
}
function UtmView({ data }: { data: Utm }) {
  // The content split arrives with each campaign; drilling reads nothing new.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = data.rows.find((row) => row.key === openKey && !row.untagged) ?? null;
  return <section className="flex min-w-0 flex-col gap-3">
    <nav aria-label="Tingkat UTM" className="min-w-0"><ol className="flex flex-wrap items-center gap-1 text-base font-semibold">
      <li>{open ? <Button variant="link" className="h-auto p-0" onClick={() => setOpenKey(null)}>Semua kampanye</Button> : <span aria-current="page">Semua kampanye</span>}</li>
      {open && <li className="flex min-w-0 items-center gap-1"><span aria-hidden="true">›</span><span aria-current="page" className="break-words">{utmCampaign(open)}</span></li>}
    </ol></nav>
    {open ? <>
      <p className="text-sm">{utmOrigin(open)} · rincian per utm_content</p>
      <UtmTable label="Konten" rows={open.contents.map((content) => ({ key: content.content ?? '', name: content.content ?? '(tanpa content)', metrics: content }))} />
    </> : <>
      <p className="text-sm">{number(data.totals.orders)} pesanan · {money(data.totals.revenue)} omset · {percent(data.tagged_share)} pesanan ber-UTM</p>
      <p className="text-xs text-muted-foreground">Ketuk kampanye untuk rincian per konten. Tag disatukan tanpa beda huruf besar/kecil dan spasi. Closing = pesanan / (pesanan + lead). RTS merah = retur di atas 20%. <a className="underline underline-offset-4" href="/admin/ads/utm">Buat link UTM</a></p>
      <UtmTable label="Kampanye" rows={data.rows.map((row) => ({
        key: row.key,
        name: row.untagged ? utmCampaign(row) : <DrillName label={utmCampaign(row)} onOpen={() => setOpenKey(row.key)} />,
        detail: utmOrigin(row),
        metrics: row,
      }))} />
    </>}
  </section>;
}
