import { useEffect, useState } from "react";
import { Bike, Car, Container, PackageCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { defaultPickupSlot, type MengantarPickupChoice, type MengantarPickupVolume } from "@/lib/mengantar-order";
import { MengantarPickupFields } from "./MengantarPickupFields";

export type MengantarPushResult = {
  orderId: string | number;
  status: string;
  cnoteNo?: string;
  error?: string;
};

/** Mengantar `pickup.volume`: the vehicle sent to collect; motor unless the operator says otherwise. */
const VEHICLES = [
  { value: "volumeMotor", label: "Motor", icon: Bike },
  { value: "volumeMobil", label: "Mobil", icon: Car },
  { value: "volumeTruck", label: "Truk", icon: Container },
] as const;

const statusLabels: Record<string, string> = {
  dispatched: "Terkirim",
  already_dispatched: "Sudah terkirim",
  unpaid: "Draft, saldo wallet kurang",
  outcome_unknown: "Belum pasti, cek Mengantar",
  waiting_for_payment: "Menunggu pembayaran",
  waiting_for_confirmation: "Menunggu konfirmasi",
  in_progress: "Sedang diproses",
  failed: "Gagal",
};
// Not a refusal: the order waits on something else and is not pushed yet.
const waitingStatuses = new Set(["unpaid", "outcome_unknown", "waiting_for_payment", "waiting_for_confirmation", "in_progress"]);

/**
 * Push to Mengantar (PRD A46): drop-off, or a scheduled pickup with date,
 * hour and vehicle (motor by default). The caller sends; this collects the
 * choice and shows each order's outcome.
 */
export function MengantarPushDialog({
  open,
  onOpenChange,
  orderLabels,
  submit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Order id → invoice number, in push order. */
  orderLabels: Array<{ id: string | number; label: string }>;
  submit: (pickup: MengantarPickupChoice) => Promise<{ message: string; results: MengantarPushResult[] }>;
}) {
  const [mode, setMode] = useState<"dropOff" | "scheduledPickup">("dropOff");
  const [slot, setSlot] = useState(defaultPickupSlot);
  const [volume, setVolume] = useState<MengantarPickupVolume>("volumeMotor");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ message: string; results: MengantarPushResult[] } | null>(null);

  // Each opening starts clean, on the earliest slot still bookable.
  useEffect(() => {
    if (!open) return;
    setSlot(defaultPickupSlot());
    setError("");
    setOutcome(null);
  }, [open]);

  const count = orderLabels.length;
  const labelOf = new Map(orderLabels.map((item) => [String(item.id), item.label]));

  const send = async () => {
    if (sending || count === 0) return;
    setSending(true);
    setError("");
    try {
      setOutcome(await submit(mode === "dropOff" ? { type: "dropOff" } : { type: "scheduledPickup", date: slot.date, hour: slot.hour, volume }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Push ke Mengantar gagal.");
    } finally {
      setSending(false);
    }
  };

  const option = (active: boolean) =>
    cn("h-auto w-full flex-col items-start gap-1 whitespace-normal py-2.5 text-left", active && "border-primary bg-primary/5 text-foreground hover:bg-primary/10");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!sending) onOpenChange(next); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kirim {count} order ke Mengantar</DialogTitle>
          <DialogDescription>
            {count === 1 ? orderLabels[0]?.label : `${orderLabels.slice(0, 3).map((item) => item.label).join(", ")}${count > 3 ? ` +${count - 3} lainnya` : ""}`}
          </DialogDescription>
        </DialogHeader>

        {outcome ? (
          <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
            <p className="text-sm">{outcome.message}</p>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {outcome.results.map((result) => (
                <li key={result.orderId} className="flex min-w-0 items-start justify-between gap-3 px-3 py-2">
                  <span className="shrink-0 font-medium">{labelOf.get(String(result.orderId)) ?? `#${result.orderId}`}</span>
                  <span className={cn("min-w-0 text-right text-xs", result.status === "dispatched" || result.status === "already_dispatched" ? "text-emerald-700" : waitingStatuses.has(result.status) ? "text-amber-700" : "text-rose-700")}>
                    {statusLabels[result.status] ?? result.status}
                    {result.cnoteNo ? ` · ${result.cnoteNo}` : ""}
                    {result.error && result.status !== "dispatched" ? <span className="block break-words text-muted-foreground">{result.error}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <div role="radiogroup" aria-label="Cara serah paket" className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" role="radio" aria-checked={mode === "dropOff"} className={option(mode === "dropOff")} onClick={() => setMode("dropOff")}>
                <span className="flex items-center gap-1.5 font-medium"><PackageCheck aria-hidden="true" />Drop-off</span>
                <span className="text-xs font-normal text-muted-foreground">Antar sendiri ke counter kurir</span>
              </Button>
              <Button type="button" variant="outline" role="radio" aria-checked={mode === "scheduledPickup"} className={option(mode === "scheduledPickup")} onClick={() => setMode("scheduledPickup")}>
                <span className="flex items-center gap-1.5 font-medium"><Truck aria-hidden="true" />Pickup</span>
                <span className="text-xs font-normal text-muted-foreground">Kurir menjemput ke gudang</span>
              </Button>
            </div>

            {mode === "scheduledPickup" && (
              <>
                <MengantarPickupFields idPrefix="push-pickup" date={slot.date} hour={slot.hour} onChange={setSlot} />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span id="push-pickup-volume" className="text-sm font-medium">Kendaraan</span>
                  <div role="radiogroup" aria-labelledby="push-pickup-volume" className="grid grid-cols-3 gap-2">
                    {VEHICLES.map((vehicle) => (
                      <Button key={vehicle.value} type="button" variant="outline" role="radio" aria-checked={volume === vehicle.value} className={option(volume === vehicle.value)} onClick={() => setVolume(vehicle.value)}>
                        <span className="flex items-center gap-1.5 font-medium"><vehicle.icon aria-hidden="true" />{vehicle.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Satu jadwal pickup per gudang untuk semua order ini.</p>
              </>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {outcome ? (
            <Button type="button" onClick={() => onOpenChange(false)}>Selesai</Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>Batal</Button>
              <Button type="button" disabled={sending || count === 0} onClick={() => void send()}>
                {sending ? "Mengirim…" : mode === "dropOff" ? `Kirim ${count} order` : `Jadwalkan & kirim ${count}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
