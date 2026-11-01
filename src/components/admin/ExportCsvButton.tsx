import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Downloads the screen's rows as CSV (`/api/admin/orders/export`), under the
 * query the screen itself sends; page and limit are ignored there.
 *
 * Fetched, not a plain `<a download>`: a link saved whatever came back — the
 * JSON of a refused filter, the login page after a lapsed session — as the
 * "CSV", and the response's `X-Export-Truncated` never reached anyone
 * (review 2026-11-01). Now an error is a toast and a cut file says so.
 */
export function ExportCsvButton({
  kind,
  query,
  title,
}: {
  kind: "orders" | "abandoned" | "shipping";
  query: URLSearchParams;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    const params = new URLSearchParams(query);
    params.set("kind", kind);
    for (const key of ["page", "limit", "source_options"]) params.delete(key);
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/orders/export?${params}`, { headers: { Accept: "text/csv" } });
      const type = response.headers.get("content-type") || "";
      if (!response.ok || !type.startsWith("text/csv")) {
        if (response.status === 401) throw new Error("Sesi login berakhir. Login lagi lalu ulangi export.");
        if (response.status === 403) throw new Error("Akun ini tidak punya akses ke data tersebut.");
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Export gagal dibuat.");
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || `${kind}.csv`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const truncated = response.headers.get("x-export-truncated");
      if (truncated) {
        toast.warning(`File berisi ${Number(truncated).toLocaleString("id-ID")} baris pertama saja. Persempit periode untuk sisanya.`);
      } else {
        toast.success("CSV diunduh.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export gagal dibuat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={() => void download()} disabled={busy} aria-busy={busy} title={title}>
      {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
      {busy ? "Menyiapkan…" : "Export CSV"}
    </Button>
  );
}
