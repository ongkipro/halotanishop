import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatIdr } from "@/lib/format-idr";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

/** One row of /api/payment-methods: the same list and readiness checkout offers. */
type PaymentMethod = {
  code: string;
  payment_method: string;
  channel_code: string | null;
  seller_bank_account_id?: number;
  name: string;
  fee_description?: string;
  is_active: boolean;
};

/**
 * COD → transfer or VA/QRIS when the buyer asks to pay first (PRD REQ-250,
 * src/lib/payment-switch.ts). The server re-checks every condition on save.
 */
export function PaymentSwitchDialog({
  invoice,
  totalAmount,
  onSwitched,
}: {
  invoice: string;
  /** The order total once the COD fee is dropped. */
  totalAmount: number;
  onSwitched: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || methods) return;
    void fetch("/api/payment-methods", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { data?: PaymentMethod[] }) =>
        setMethods((body.data || []).filter((method) => method.is_active && method.payment_method !== "cod")))
      .catch(() => setLoadError("Metode pembayaran gagal dimuat."));
  }, [open, methods]);

  const chosen = methods?.find((method) => method.code === code) ?? null;

  const save = async () => {
    if (!chosen || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(invoice)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "switch-payment",
          switch_payment: chosen.payment_method === "manual_transfer"
            ? { payment_method: "manual_transfer", seller_bank_account_id: chosen.seller_bank_account_id }
            : { payment_method: chosen.payment_method, payment_channel: chosen.channel_code },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || "Pembayaran gagal diganti.");
      toast.success(payload.message || "Pembayaran diganti.");
      setOpen(false);
      onSwitched();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Pembayaran gagal diganti.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        Ganti ke transfer / VA
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!saving) { setOpen(next); setError(""); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ganti pembayaran COD</DialogTitle>
            <DialogDescription>
              Untuk pembeli yang ingin membayar lebih dulu. Biaya COD dihapus dan pesanan baru bisa dikirim setelah lunas.
            </DialogDescription>
          </DialogHeader>
          {loadError ? (
            <p role="alert" className="text-sm text-rose-700">{loadError}</p>
          ) : !methods ? (
            <p role="status" className="text-sm text-slate-600">Memuat metode pembayaran…</p>
          ) : methods.length === 0 ? (
            <p className="text-sm text-slate-600">
              Belum ada metode non-COD yang aktif. <a className="underline underline-offset-4" href="/admin/payments#rekening-bank-section">Tambahkan rekening toko</a> atau aktifkan AutoLaris di Pengaturan Pembayaran.
            </p>
          ) : (
            <div className="space-y-3">
              {/* A list rather than a Select: a Base UI Select portalled out
                  of this Radix dialog loses its selection to the dialog's
                  outside-click handling, and the fee belongs beside each name. */}
              <div role="group" aria-label="Metode pembayaran baru" className="max-h-72 space-y-2 overflow-y-auto">
                {methods.map((method) => (
                  <Button
                    key={method.code}
                    type="button"
                    variant={method.code === code ? "default" : "outline"}
                    aria-pressed={method.code === code}
                    className="h-auto w-full justify-between gap-3 py-2 text-left"
                    onClick={() => setCode(method.code)}
                  >
                    <span className="font-semibold">{method.name}</span>
                    {method.fee_description && <span className="text-xs font-normal opacity-80">{method.fee_description}</span>}
                  </Button>
                ))}
              </div>
              {/* Manual transfer is offered only for an active store account. */}
              {!methods.some((method) => method.payment_method === "manual_transfer") && (
                <p className="text-xs text-slate-600">
                  Transfer ke rekening toko belum tersedia. <a className="underline underline-offset-4" href="/admin/payments#rekening-bank-section">Tambahkan rekening bank</a>
                </p>
              )}
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-600">Total tanpa biaya COD</span>
                <strong className="text-slate-900">{formatIdr(totalAmount)}</strong>
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Batal</Button>
            <Button type="button" disabled={!chosen || saving} onClick={() => void save()}>
              {saving ? "Menyimpan…" : "Ganti pembayaran"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
