import { useState } from "react";
import { Check, Copy, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { buildUtmLink, normalizeUtmTag, UTM_MEDIUMS, UTM_SOURCES } from "@/lib/utm-link";
import { FilterSelect } from "./filter-bar";

export type UtmLinkPage = { url: string; label: string; kind: "landing" | "product" };

const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";
const KIND_LABEL = { landing: "Landing page", product: "Produk" } as const;
/** The page's name without its path; the path shows under the field once chosen. */
const pageTitle = (page: UtmLinkPage) => page.label.split(" · ")[0];

/**
 * PRD A45, REQ-262: compose a tagged link to one of the store's pages. Nothing
 * is stored. Form on the left, the link and its tags on the right (sticky on
 * wide screens); the page picker is searchable because a catalogue grows.
 */
export function UtmLinkBuilder({ pages }: { pages: UtmLinkPage[] }) {
  const [page, setPage] = useState<UtmLinkPage | null>(null);
  const [source, setSource] = useState<string>(UTM_SOURCES[0].value);
  const [medium, setMedium] = useState<string>(UTM_SOURCES[0].medium);
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [copied, setCopied] = useState(false);
  const result = buildUtmLink({ page: page?.url ?? "", source, medium, campaign, content });

  const copy = async () => {
    if (!result.ok) return;
    try {
      if (!navigator.clipboard) throw new Error("Salin butuh https. Salin link secara manual.");
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Link UTM disalin.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Link gagal disalin.");
    }
  };

  if (pages.length === 0) {
    return <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <h2 className="text-base font-semibold">Belum ada halaman aktif</h2>
      <p className="mt-2 text-muted-foreground">Aktifkan produk atau landing page dulu, lalu kembali ke sini untuk membuat link.</p>
    </div>;
  }

  const missing = [
    !page && "Pilih halaman tujuan",
    !normalizeUtmTag(campaign) && "Isi nama kampanye",
  ].filter(Boolean) as string[];
  if (!result.ok && missing.length === 0) missing.push(result.reason);

  return <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <section className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="utm-page" className={labelClass}>Halaman tujuan</label>
        <Combobox
          items={pages}
          value={page}
          onValueChange={(next) => setPage((next as UtmLinkPage | null) ?? null)}
          itemToStringLabel={(item: UtmLinkPage) => pageTitle(item)}
          itemToStringValue={(item: UtmLinkPage) => item.url}
          isItemEqualToValue={(item: UtmLinkPage, current: UtmLinkPage) => item.url === current.url}
          autoHighlight
        >
          <ComboboxInput id="utm-page" className="w-full" placeholder="Cari landing page atau produk…" showClear={Boolean(page)} autoComplete="off" />
          <ComboboxContent>
            <ComboboxEmpty>Halaman tidak ditemukan.</ComboboxEmpty>
            <ComboboxList>
              {(item: UtmLinkPage) => (
                <ComboboxItem key={item.url} value={item} className="py-2">
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{pageTitle(item)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABEL[item.kind]}</span>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {page && <p className={cn(hintClass, "truncate")}>{new URL(page.url).pathname}</p>}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span id="utm-source-label" className={labelClass}>Sumber</span>
        <div role="radiogroup" aria-labelledby="utm-source-label" className="flex flex-wrap gap-2">
          {UTM_SOURCES.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={source === item.value ? "default" : "outline"}
              role="radio"
              aria-checked={source === item.value}
              onClick={() => { setSource(item.value); setMedium(item.medium); }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="utm-medium" className={labelClass}>Medium</label>
          <FilterSelect id="utm-medium" icon={Megaphone} value={medium} options={UTM_MEDIUMS} onValueChange={setMedium} />
          <p className={hintClass}>Terisi otomatis sesuai sumber.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="utm-campaign" className={labelClass}>Nama kampanye</label>
          <Input id="utm-campaign" value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Promo Oktober Kopi" autoComplete="off" aria-describedby="utm-campaign-hint" />
          <p id="utm-campaign-hint" className={cn(hintClass, "truncate")}>Tercatat sebagai <code>{normalizeUtmTag(campaign) || "…"}</code></p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="utm-content" className={labelClass}>Konten iklan <span className="font-normal text-muted-foreground">(opsional)</span></label>
        <Input id="utm-content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Video A" autoComplete="off" aria-describedby="utm-content-hint" />
        <p id="utm-content-hint" className={hintClass}>Untuk membedakan materi iklan di Analitik › UTM.</p>
      </div>
    </section>

    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 md:p-5 lg:sticky lg:top-20" aria-live="polite">
      <h2 className="text-base font-semibold">Link siap pakai</h2>
      {result.ok ? <>
        <p className="break-all rounded-md bg-muted px-3 py-2.5 font-mono text-sm leading-relaxed">{result.url}</p>
        <Button type="button" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "Tersalin" : "Salin link"}
        </Button>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          {[["utm_source", source], ["utm_medium", medium], ["utm_campaign", result.campaign], ...(result.content ? [["utm_content", result.content]] : [])].map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="truncate font-mono">{value}</dd>
            </div>
          ))}
        </dl>
        <p className={hintClass}>Tempel di URL tujuan iklan atau pesan WhatsApp; pesanannya terbaca di Analitik › UTM.</p>
      </> : (
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {missing.map((item) => <li key={item} className="flex items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />{item}</li>)}
        </ul>
      )}
    </section>
  </div>;
}
